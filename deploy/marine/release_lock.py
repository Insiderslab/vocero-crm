from __future__ import annotations
import os, socket
from pathlib import Path
class LockRefusal(RuntimeError): pass
class ReleaseLock:
    def __init__(self,path:Path):
        self.path=Path(path); self.fd=None; self.token=f'{os.getpid()}:{socket.gethostname()}:{os.urandom(16).hex()}'.encode('ascii'); self.identity=None
    def acquire(self):
        try:
            self._validate_parent()
            self.fd=os.open(self.path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
            os.write(self.fd,self.token); os.fsync(self.fd); st=os.fstat(self.fd); self.identity=(st.st_dev,st.st_ino)
            if os.name=='posix': os.fchmod(self.fd,0o600)
            self._fsync_parent()
            return self
        except FileExistsError as exc: raise LockRefusal('A release operation lock already exists; stale locks require operator recovery.') from exc
        except OSError as exc:
            self._close(); raise LockRefusal('The release operation lock could not be acquired safely.') from exc
    def release(self):
        if self.fd is None: return
        try:
            st=os.stat(self.path,follow_symlinks=False); opened=os.fstat(self.fd)
            if (st.st_dev,st.st_ino)!=self.identity or (opened.st_dev,opened.st_ino)!=self.identity: raise LockRefusal('Release lock identity changed; refusing removal.')
            read_fd=os.open(self.path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
            try:
                if os.read(read_fd,len(self.token))!=self.token: raise LockRefusal('Release lock token changed; refusing removal.')
            finally: os.close(read_fd)
            if os.name == 'nt':
                self._close()
                latest=os.stat(self.path,follow_symlinks=False)
                if (latest.st_dev,latest.st_ino)!=self.identity: raise LockRefusal('Release lock identity changed before removal.')
            self.path.unlink()
            self._fsync_parent()
        except FileNotFoundError as exc: raise LockRefusal('Release lock disappeared while held.') from exc
        finally: self._close()
    def assert_held(self):
        if self.fd is None or self.identity is None: raise LockRefusal('The required release lock is not held.')
        try:
            path_stat=os.stat(self.path,follow_symlinks=False); fd_stat=os.fstat(self.fd)
            if (path_stat.st_dev,path_stat.st_ino)!=self.identity or (fd_stat.st_dev,fd_stat.st_ino)!=self.identity:
                raise LockRefusal('The held release lock identity changed.')
            read_fd=os.open(self.path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
            try:
                if os.read(read_fd,len(self.token))!=self.token: raise LockRefusal('The held release lock token changed.')
            finally: os.close(read_fd)
        except OSError as exc: raise LockRefusal('The held release lock cannot be verified.') from exc
    def _validate_parent(self):
        parent=self.path.parent
        if parent.is_symlink() or not parent.is_dir(): raise LockRefusal('Release lock parent is missing or unsafe.')
        if os.name=='posix' and self.path.absolute().is_relative_to(Path('/opt/bambola-arm')):
            current=parent
            while True:
                st=os.stat(current,follow_symlinks=False)
                if not Path(current).is_dir() or Path(current).is_symlink() or st.st_uid!=0 or st.st_mode & 0o022:
                    raise LockRefusal('Release lock ancestor is not root-owned or is writable by group/other.')
                if current==Path('/opt'): break
                if Path('/opt') not in current.parents: raise LockRefusal('Release lock escaped the fixed evidence root.')
                current=current.parent
            if parent.stat().st_mode & 0o777 != 0o700: raise LockRefusal('Release lock parent must be mode 0700.')
    def _fsync_parent(self):
        if os.name=='posix':
            fd=os.open(self.path.parent,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
            try: os.fsync(fd)
            finally: os.close(fd)
    def _close(self):
        if self.fd is not None: os.close(self.fd); self.fd=None
    def __enter__(self): return self.acquire()
    def __exit__(self,exc_type,exc,tb): self.release()
