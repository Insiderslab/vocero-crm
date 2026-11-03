import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

MARINE = Path(__file__).parents[1]
sys.path.insert(0, str(MARINE))
import crm_host
import crm_rollout as rollout


class CrmRolloutTests(unittest.TestCase):
    def setUp(self):
        self.app_old = {'name': rollout.APP, 'id': 'app-old', 'imageId': 'sha256:'+'1'*64,
                        'configuredImage': 'sha256:'+'1'*64, 'running': True, 'health': 'healthy',
                        'ports': {}, 'networks': {'edge': {'aliases':['app']}},
                        'runtime': {'memory':512,'capDrop':['ALL'],'mounts':[]}}
        self.gateway_old = {'name': rollout.GATEWAY, 'id': 'gateway-old', 'imageId':'sha256:'+'2'*64,
                            'configuredImage':'sha256:'+'2'*64,'running':True,'health':'healthy','ports':{},
                            'networks':{'edge':{'aliases':['gateway']}},
                            'runtime':{'memory':64,'capDrop':['ALL'],'mounts':[{'Type':'bind','Source':'/opt/bambola-arm/runtime/gateway.Caddyfile','Destination':'/etc/caddy/Caddyfile','Mode':'ro','RW':False}]}}
        self.caddy = {'name': rollout.CADDY, 'id':'caddy-id','imageId':'sha256:caddy','startedAt':'t','restartCount':0,'running':True,'health':'healthy'}
        self.hair = {'name':'hair-app-1','id':'hair-id','imageId':'sha256:hair','startedAt':'t','restartCount':0,'running':True,'health':'healthy','ports':{'8080/tcp':[{'hostPort':'9443'}]}}
        self.route = {'status':200,'tlsVerified':True,'location':None}
        self.own_route_old = {'status':302,'tlsVerified':True,'location':'https://bambola.heili.cloud/nautica'}
        self.own_route_new = {'status':302,'tlsVerified':True,'location':'https://bambola.heili.cloud/dashboard'}
        self.base = {
            'caddy': {'container':self.caddy,'config':{'inode':42,'sha256':'a'*64}},
            'containers':[self.app_old,self.gateway_old,self.caddy,self.hair],
            'ownedAppGateway': {'app':self.app_old,'gateway':self.gateway_old},
            'networks':[{'id':'net-edge','name':'edge','driver':'bridge','internal':True,'ipam':{},'containers':{
                'app-old':{'name':rollout.APP,'endpointId':'ea','ipv4Address':'10.0.0.2'},
                'gateway-old':{'name':rollout.GATEWAY,'endpointId':'eg','ipv4Address':'10.0.0.3'},
                'hair-id':{'name':'hair-app-1','endpointId':'eh','ipv4Address':'10.1.0.2'}}}],
            'routes':{url:[self.own_route_old if url == rollout.DOMAIN+'/' else self.route] for url in crm_host.ROUTES},
            'configFiles':{
                'compose':{'path':'/opt/bambola-arm/releases/r1/deploy/marine/compose.ubuntu.yml','sha256':'b'*64},
                'pinnedBaseCompose':{'path':str(rollout.BASE_COMPOSE),'sha256':'c'*64},
                'runtimeEnv':{'path':str(rollout.ENV_FILE),'sha256':'d'*64},
                'runtimeOverride':{'path':str(rollout.PANEL_OVERRIDE),'sha256':'e'*64},
            },
            'resources':{'memAvailableKiB':1000000,'optFreeKiB':15*1024*1024},
        }
        self.plan = {
            'imageId':'sha256:'+'3'*64,
            'previousApp':self.app_old,'previousGateway':self.gateway_old,
            'newGateway':{'path':'/opt/bambola-arm/runtime/gateway-crm-r1.Caddyfile','sha256':'d'*64},
            'oldGateway':{'path':'/opt/bambola-arm/runtime/gateway.Caddyfile','sha256':'e'*64},
        }

    def changed(self, mutate):
        current=copy.deepcopy(self.base)
        mutate(current)
        with self.assertRaises(rollout.Refusal): rollout.verify_external_unchanged(self.base,current)

    def test_external_caddy_hair_container_route_and_network_drift_refuse(self):
        self.changed(lambda c: c['caddy']['config'].__setitem__('sha256','f'*64))
        self.changed(lambda c: c['containers'][3].__setitem__('id','hair-replaced'))
        self.changed(lambda c: c['containers'][3]['ports']['8080/tcp'][0].__setitem__('hostPort','9999'))
        self.changed(lambda c: c['networks'][0]['containers']['hair-id'].__setitem__('endpointId','changed'))
        self.changed(lambda c: c['routes'][crm_host.ROUTES[0]].__setitem__(0,{'status':503,'tlsVerified':True,'location':None}))

    def updated_current(self):
        current=copy.deepcopy(self.base)
        app=current['ownedAppGateway']['app']; gateway=current['ownedAppGateway']['gateway']
        app.update(id='app-new',imageId=self.plan['imageId'],configuredImage=self.plan['imageId'])
        gateway.update(id='gateway-new')
        gateway['runtime']['mounts'][0]['Source']=self.plan['newGateway']['path']
        current['containers'][0]=app; current['containers'][1]=gateway
        current['networks'][0]['containers'].pop('app-old'); current['networks'][0]['containers'].pop('gateway-old')
        current['networks'][0]['containers']['app-new']={'name':rollout.APP,'endpointId':'new-a','ipv4Address':'10.0.0.4'}
        current['networks'][0]['containers']['gateway-new']={'name':rollout.GATEWAY,'endpointId':'new-g','ipv4Address':'10.0.0.5'}
        current['routes'][rollout.DOMAIN+'/']=[self.own_route_new]
        return current

    def test_pinned_expected_app_and_gateway_changes_pass(self):
        with patch.object(rollout,'safe_run',return_value='marine'):
            rollout.verify_services(self.plan,self.base,self.updated_current())

    def test_wrong_app_image_mount_ports_or_runtime_caps_refuse(self):
        for change in (
            lambda c: c['ownedAppGateway']['app'].__setitem__('imageId','sha256:wrong'),
            lambda c: c['ownedAppGateway']['gateway']['runtime']['mounts'][0].__setitem__('Source','/tmp/other'),
            lambda c: c['ownedAppGateway']['app']['ports'].update({'3000/tcp':[{'hostPort':'3000'}]}),
            lambda c: c['ownedAppGateway']['app']['runtime'].__setitem__('memory',1024),
        ):
            current=self.updated_current(); change(current)
            with patch.object(rollout,'safe_run',return_value='marine'):
                with self.assertRaises(rollout.Refusal): rollout.verify_services(self.plan,self.base,current)

    def config_pair(self):
        old={
            'services':{
                'postgres':{'image':'sha256:db','environment':{'POSTGRES_PASSWORD':'do-not-print'},'networks':['bambola_data']},
                'app':{'image':self.app_old['configuredImage'],'environment':{'APP_BASE_URL':'https://bambola.heili.cloud'},'ports':[], 'networks':{'bambola_edge':{},'bambola_data':{}},'mem_limit':'512m','cap_drop':['ALL']},
                'gateway':{'image':self.gateway_old['configuredImage'],'volumes':[{'type':'bind','source':self.plan['oldGateway']['path'],'target':'/etc/caddy/Caddyfile','read_only':True}],'ports':[],'networks':{'bambola_edge':{},'second-brain_frontend':{}},'mem_limit':'64m','cap_drop':['ALL']},
            },
            'networks':{'bambola_edge':{'internal':True},'bambola_data':{'internal':True},'second-brain_frontend':{'external':True}},
        }
        new=copy.deepcopy(old)
        new['services']['app']['image']=self.plan['imageId']
        new['services']['app']['environment']['APP_WORKSPACE']='marine'
        new['services']['gateway']['volumes'][0]['source']=self.plan['newGateway']['path']
        return old,new

    def test_compose_delta_accepts_only_image_profile_and_gateway_mount(self):
        old,new=self.config_pair()
        rollout.validate_compose_delta(old,new,expected_image=self.plan['imageId'],expected_gateway=self.plan['newGateway']['path'],profile='marine')

    def test_missing_or_invalid_profile_and_wrong_mount_refuse(self):
        old,new=self.config_pair()
        for value in (None,'standard','invalid'):
            candidate=copy.deepcopy(new)
            if value is None: candidate['services']['app']['environment'].pop('APP_WORKSPACE')
            else: candidate['services']['app']['environment']['APP_WORKSPACE']=value
            with self.assertRaises(rollout.Refusal): rollout.validate_compose_delta(old,candidate,expected_image=self.plan['imageId'],expected_gateway=self.plan['newGateway']['path'],profile='marine')
        candidate=copy.deepcopy(new); candidate['services']['gateway']['volumes'][0]['source']='/tmp/wrong'
        with self.assertRaises(rollout.Refusal): rollout.validate_compose_delta(old,candidate,expected_image=self.plan['imageId'],expected_gateway=self.plan['newGateway']['path'],profile='marine')

    def test_activation_command_targets_only_fixed_services(self):
        args=rollout.compose_up_args({'compose':{'env':'/opt/bambola-arm/runtime/runtime.env','base':'/opt/bambola-arm/releases/20261102-r5/deploy/marine/compose.ubuntu.yml','panel':'/opt/bambola-arm/runtime/panels-20261102.override.yml'}},['/opt/bambola-arm/runtime/crm.override.yml'])
        self.assertEqual(args[-8:],['up','-d','--no-deps','--wait','--wait-timeout','180','app','gateway'])
        self.assertNotIn('postgres',args)
        self.assertNotIn('down',args)
        self.assertEqual(args[args.index('--project-name')+1],'bambola-arm')

    def test_shared_caddy_ip_comes_from_exact_snapshotted_frontend_attachment(self):
        snapshot={'networks':[{'name':rollout.FRONTEND_NETWORK,'containers':{
            'caddy':{'name':rollout.CADDY,'ipv4Address':'172.22.0.5/16'}}}]}
        self.assertEqual(rollout.frontend_caddy_ip(snapshot),'172.22.0.5')
        snapshot['networks'][0]['containers']['other']={'name':rollout.CADDY,'ipv4Address':'172.22.0.6/16'}
        with self.assertRaises(rollout.Refusal): rollout.frontend_caddy_ip(snapshot)

    def test_plan_phase_cas_and_stale_writer_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory); target=state/'activation-plan.json'; lock=state/'activation.lock'
            plan={'schemaVersion':1,'phase':'prepared','immutable':'pinned'}
            target.write_text(json.dumps(plan),encoding='utf-8')
            with patch.object(rollout,'PLAN',target),patch.object(rollout,'LOCK',lock),patch.object(rollout,'STATE_DIR',state):
                changed=rollout._phase_update(plan,'prepared','activating')
                self.assertEqual(changed['phase'],'activating')
                with self.assertRaises(rollout.Refusal): rollout._phase_update(plan,'prepared','activated')

    def test_redirect_location_is_captured_without_query_or_response_headers(self):
        with patch.object(crm_host,'command',return_value='302|0|https://bambola.heili.cloud/dashboard?token=secret#fragment') as run:
            route=crm_host.route_probe('bambola.heili.cloud/')
        self.assertEqual(route,{'status':302,'tlsVerified':True,'location':'https://bambola.heili.cloud/dashboard'})
        self.assertNotIn('secret',json.dumps(route))
        self.assertNotIn('-D',run.call_args.args[0])

    def test_repeat_activation_refuses_before_any_host_or_compose_call(self):
        with tempfile.TemporaryDirectory() as td, patch.object(rollout,'OP_LOCK',Path(td)/'operation.lock'), \
             patch.object(rollout,'read_plan',return_value={'phase':'activated'}), patch.object(crm_host,'check_current') as check:
            with self.assertRaisesRegex(rollout.Refusal,'Only a prepared plan'): rollout.activate('a'*64,'b'*64)
        check.assert_not_called()

    def test_activation_stops_on_preflight_drift_before_compose(self):
        plan={'phase':'prepared'}
        with tempfile.TemporaryDirectory() as td, patch.object(rollout,'OP_LOCK',Path(td)/'operation.lock'), \
             patch.object(rollout,'read_plan',return_value=plan),patch.object(rollout,'_check_artifacts'), \
             patch.object(crm_host,'check_current',side_effect=rollout.Refusal('drift')), \
             patch.object(rollout.subprocess,'run') as compose:
            with self.assertRaises(rollout.Refusal): rollout.activate('a'*64,'b'*64)
        compose.assert_not_called()

    def test_activate_orchestration_waits_health_and_accepts_own_dashboard_route(self):
        plan={'phase':'prepared','release':'/opt/bambola-arm/releases/r1','imageId':'sha256:'+'3'*64,
              'previousApp':self.app_old,'previousGateway':self.gateway_old,
              'override':{'path':'/opt/bambola-arm/runtime/crm.yml'},
              'newGateway':{'path':'/opt/bambola-arm/runtime/new.Caddyfile'},
              'compose':{'env':str(rollout.ENV_FILE),'base':str(rollout.BASE_COMPOSE),'panel':str(rollout.PANEL_OVERRIDE)}}
        activating=dict(plan,phase='activating')
        changed=self.updated_current()
        changed['ownedAppGateway']['gateway']['runtime']['mounts'][0]['Source']=plan['newGateway']['path']
        changed['containers'][1]['runtime']['mounts'][0]['Source']=plan['newGateway']['path']
        phase=lambda p,old,new:dict(p,phase=new)
        with tempfile.TemporaryDirectory() as td:
            with patch.object(rollout,'OP_LOCK',Path(td)/'operation.lock'), \
                 patch.object(rollout,'read_plan',side_effect=[plan,activating]), \
                 patch.object(rollout,'_check_artifacts'), patch.object(crm_host,'check_current'), \
                 patch.object(crm_host,'_snapshot_read',return_value=self.base), \
                 patch.object(rollout,'render_compose',side_effect=[{'old':1},{'new':1}]), \
                 patch.object(rollout,'validate_compose_delta'), \
                 patch.object(rollout,'_phase_update',side_effect=phase), \
                 patch.object(crm_host,'current_snapshot_fields',return_value=changed), \
                 patch.object(rollout,'safe_run',return_value='marine'), \
                 patch.object(rollout.subprocess,'run',return_value=SimpleNamespace(returncode=0)) as run:
                result=rollout.activate('a'*64,'b'*64)
        self.assertEqual(result['phase'],'activated')
        self.assertIn('--wait',run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs['timeout'],240)

    def test_activate_orchestration_refuses_external_hair_change_after_wait(self):
        plan={'phase':'prepared','release':'/opt/bambola-arm/releases/r1','imageId':'sha256:'+'3'*64,
              'previousApp':self.app_old,'previousGateway':self.gateway_old,
              'override':{'path':'/opt/bambola-arm/runtime/crm.yml'},
              'newGateway':{'path':'/opt/bambola-arm/runtime/new.Caddyfile'},
              'compose':{'env':str(rollout.ENV_FILE),'base':str(rollout.BASE_COMPOSE),'panel':str(rollout.PANEL_OVERRIDE)}}
        activating=dict(plan,phase='activating')
        changed=self.updated_current()
        changed['ownedAppGateway']['gateway']['runtime']['mounts'][0]['Source']=plan['newGateway']['path']
        changed['containers'][1]['runtime']['mounts'][0]['Source']=plan['newGateway']['path']
        changed['containers'][3]['id']='replaced-hair'
        with tempfile.TemporaryDirectory() as td:
            with patch.object(rollout,'OP_LOCK',Path(td)/'operation.lock'), \
                 patch.object(rollout,'read_plan',side_effect=[plan,activating]), \
                 patch.object(rollout,'_check_artifacts'), patch.object(crm_host,'check_current'), \
                 patch.object(crm_host,'_snapshot_read',return_value=self.base), \
                 patch.object(rollout,'render_compose',side_effect=[{'old':1},{'new':1}]), \
                 patch.object(rollout,'validate_compose_delta'), \
                 patch.object(rollout,'_phase_update',side_effect=lambda p,o,n:dict(p,phase=n)), \
                 patch.object(crm_host,'current_snapshot_fields',return_value=changed), \
                 patch.object(rollout.subprocess,'run',return_value=SimpleNamespace(returncode=0)):
                with self.assertRaises(rollout.Refusal):
                    rollout.activate('a'*64,'b'*64)

    def test_rollback_orchestration_uses_pinned_base_and_panel_and_retries_after_failure(self):
        app=dict(self.app_old,configuredImage='registry/bambola:r5')
        gateway=dict(self.gateway_old,configuredImage='registry/gateway:r5')
        baseline=copy.deepcopy(self.base)
        baseline['ownedAppGateway']={'app':app,'gateway':gateway}
        baseline['containers'][0]=app; baseline['containers'][1]=gateway
        plan={'phase':'activated','release':'/opt/bambola-arm/releases/r1',
              'previousApp':app,'previousGateway':gateway,
              'oldGateway':{'path':'/opt/bambola-arm/runtime/gateway.Caddyfile','sha256':'e'*64},
              'override':{'path':'/opt/bambola-arm/runtime/crm.yml'},
              'newGateway':{'path':'/opt/bambola-arm/runtime/new.Caddyfile'},
              'compose':{'env':'/opt/bambola-arm/runtime/runtime.env',
                         'base':str(rollout.BASE_COMPOSE),'panel':str(rollout.PANEL_OVERRIDE)}}
        restored=copy.deepcopy(baseline)
        with patch.object(rollout,'safe_run',return_value=''):
            rollout.verify_services({'previousApp':app,'previousGateway':gateway,'oldGateway':{'path':plan['oldGateway']['path']}},baseline,restored,rollback=True)
        activating=self.updated_current()
        observed=[activating,activating,activating,activating,
                  activating,activating,restored]
        phase_calls=[]
        with tempfile.TemporaryDirectory() as td:
            temp=Path(td); lock=temp/'operation.lock'; plan_file=temp/'plan.json'
            plan_file.write_text(json.dumps(plan),encoding='utf-8')
            def phase_update(p,old,new):
                phase_calls.append((old,new))
                updated=dict(p,phase=new)
                plan_file.write_text(json.dumps(updated),encoding='utf-8')
                return updated
            old_config={'services':{
                'app':{'image':app['configuredImage']},
                'gateway':{'image':gateway['configuredImage'],'volumes':[{
                    'target':'/etc/caddy/Caddyfile','source':plan['oldGateway']['path'],'read_only':True}]}}}
            with patch.object(rollout,'OP_LOCK',lock),patch.object(rollout,'PLAN',plan_file), \
                 patch.object(rollout,'read_plan',side_effect=[plan,dict(plan,phase='rolling_back'),
                                                               dict(plan,phase='rolling_back'),dict(plan,phase='rolling_back')]), \
                 patch.object(crm_host,'_snapshot_read',return_value=baseline), \
                 patch.object(crm_host,'current_snapshot_fields',side_effect=observed), \
                 patch.object(rollout,'render_compose',return_value=old_config), \
                 patch.object(rollout,'safe_run',side_effect=[app['imageId'],gateway['imageId'],
                                                              app['imageId'],gateway['imageId'],'']), \
                 patch.object(rollout,'_phase_update',side_effect=phase_update), \
                 patch.object(rollout.subprocess,'run',side_effect=[
                     rollout.subprocess.CalledProcessError(1,['docker','compose']),
                     SimpleNamespace(returncode=0)]) as run:
                with self.assertRaises(rollout.Refusal):
                    rollout.rollback('a'*64,'b'*64)
                result=rollout.rollback('a'*64,'b'*64)
        self.assertEqual(result['phase'],'rolled_back')
        self.assertEqual(run.call_args.args[0][-8:],['up','-d','--no-deps','--wait','--wait-timeout','180','app','gateway'])
        self.assertEqual(run.call_args.args[0].count('-f'),2)
        self.assertEqual(phase_calls,[('activated','rolling_back'),('rolling_back','rolled_back')])

    def test_verify_services_rejects_wrong_own_root_redirect(self):
        current=self.updated_current()
        current['routes'][rollout.DOMAIN+'/']=[self.own_route_old]
        with patch.object(rollout,'safe_run',return_value='marine'):
            with self.assertRaisesRegex(rollout.Refusal,'root route'):
                rollout.verify_services(self.plan,self.base,current)

    def test_compose_failure_does_not_echo_secret_config(self):
        with patch.object(rollout.subprocess,'run',return_value=type('R',(),{'returncode':1,'stdout':'sensitive-password','stderr':'sensitive-password'})()):
            with self.assertRaises(rollout.Refusal) as error:
                rollout.render_compose({'compose':{'env':'secret-file','base':'base','panel':'panel'}},[])
        self.assertNotIn('sensitive-password',str(error.exception))


if __name__=='__main__':
    unittest.main()
