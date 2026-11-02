import { z } from "zod";

// PostgreSQL JSON/text cannot represent NUL or isolated UTF-16 surrogates.
function checkTextEncoding(value: Record<string, unknown>, ctx: z.RefinementCtx) {
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") continue;
    if (item.includes("\u0000") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "El texto contiene un carácter no válido." });
    }
  }
}

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const uuid = z.string().uuid();
const label = z.string().trim().min(2).max(160);
const note = z.string().trim().min(2).max(1000);
const money = z.number().int().min(0).max(100_000_000);
const currency = z.enum(["USD", "VES"]);
const base = { requestId: uuid, tripId: id };
const admin = <T extends string, F extends z.ZodRawShape = Record<never, never>>(action: T, fields = {} as F) => z.object({ action: z.literal(action), ...base, ...fields }).strict();
const phone = z.string().trim().max(25).transform(v => v.replace(/\s+/g, "")).pipe(z.string().min(7).max(25).regex(/^\+?[0-9]+$/));
const identity = {
  name: z.string().trim().min(2).max(120),
  documentType: z.enum(["cedula", "passport", "other", "representative"]),
  documentNumber: z.string().trim().min(3).max(40), phone,
  email: z.string().trim().email().max(254).or(z.literal("")).default(""),
  minor: z.boolean().default(false),
  representativeName: z.string().trim().max(120).default(""),
};
const createTrip = z.object({ action:z.literal("createTrip"), requestId:uuid, title:z.string().trim().min(2).max(120), startAt:z.string().datetime({offset:true}), endAt:z.string().datetime({offset:true}), mode:z.enum(["public","private"]), capacity:z.number().int().min(1).max(130) }).strict();
const schemas = [
createTrip,
admin("createBooking",{reference:z.string().trim().min(1).max(80),customerName:z.string().trim().min(2).max(120),customerPhone:phone,seats:z.number().int().min(1).max(130),status:z.enum(["confirmed","waitlist"]),agency:z.string().max(100).default(""),totalMinor:money.default(0),currency:currency.default("USD")}),
admin("promoteBooking",{bookingId:id}),admin("cancelBooking",{bookingId:id,reason:note}),
admin("changeTripStatus",{status:z.enum(["boarding","underway","completed","cancelled"]),physicalCount:z.number().int().min(0).max(130).optional(),paperEntriesResolved:z.boolean().optional(),reason:note.optional()}),
admin("addPayment",{bookingId:id,amountMinor:money.min(1),currency,method:z.string().trim().min(1).max(40),reference:z.string().max(120).default("")}),
admin("addCost",{label,amountMinor:money,currency}),
admin("addService",{bookingId:id.optional(),label,quantity:z.number().int().min(1).max(130),unitAmountMinor:money.default(0),currency:currency.default("USD"),assignedMemberId:id.nullable().optional(),assignedTo:z.string().max(120).default("")}),
admin("addServiceRequest",{bookingId:id.optional(),label,quantity:z.number().int().min(1).max(130)}),
admin("changeServiceStatus",{serviceId:id,status:z.enum(["pending","doing","done"])}),admin("addIncident",{text:note}),
admin("exportManifest"),admin("rotateRegistration",{passengerId:id}),
admin("lookupTicket",{ticketCode:z.string().regex(/^[A-F0-9]{32}$/)}),
admin("movePassenger",{passengerId:id.optional(),ticketCode:z.string().regex(/^[A-F0-9]{32}$/).optional(),movement:z.enum(["board","offboard","return","deboard"])}),
admin("flagReconciliation",{note}),admin("correctMovement",{passengerId:id,expectedMovement:z.enum(["awaiting","aboard","away","deboarded"]),expectedRevision:z.number().int().positive(),newMovement:z.enum(["awaiting","aboard","away","deboarded"]),reason:note}),
admin("resolveReconciliation",{expectedRevision:z.number().int().positive(),reason:note,physicalCount:z.number().int().min(0).max(130)}),
admin("correctPassenger",{passengerId:id,expectedRevision:z.number().int().positive(),reason:note,...identity})
] as const;
const commandUnion = z.discriminatedUnion("action", schemas);
export const marineCommandSchema = commandUnion.superRefine((x,ctx)=>{
  checkTextEncoding(x, ctx);
  if(x.action === "addService" && x.assignedTo !== "") ctx.addIssue({code:z.ZodIssueCode.custom,message:"Usa assignedMemberId para asignar un responsable.",path:["assignedTo"]});
  if(x.action === "movePassenger" && Boolean(x.passengerId) === Boolean(x.ticketCode)) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Indica pasajero o código, no ambos."});
  if(x.action === "correctPassenger" && x.minor && x.representativeName.length < 2) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Indica el nombre del representante.",path:["representativeName"]});
  if(x.action === "createTrip") {
    const duration = Date.parse(x.endAt) - Date.parse(x.startAt);
    if(duration <= 0 || duration > 48 * 60 * 60 * 1000) ctx.addIssue({code:z.ZodIssueCode.custom,message:"El paseo debe durar entre un minuto y 48 horas.",path:["endAt"]});
  }
});
export type ValidMarineCommand = z.infer<typeof marineCommandSchema>;
export const publicRegistrationSchema = z.object({...identity,confirmed:z.literal(true),marketingOptIn:z.boolean().default(false),requestId:uuid}).strict().superRefine((v,ctx)=>{checkTextEncoding(v,ctx);if(v.minor&&v.representativeName.length<2)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Para un menor, indica el nombre del representante.",path:["representativeName"]})});
export const publicTokenSchema=z.object({v:z.literal(1),organizationId:id,tripId:id,passengerId:id,secret:z.string().regex(/^[A-F0-9]{32}$/)}).strict();
export function parseMarineCommand(value:unknown){return marineCommandSchema.safeParse(value)}




