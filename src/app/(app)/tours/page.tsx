import { MarineApp } from "@/components/marine/marine-app";

export const metadata = { title: "Calendario y tours" };

export default function ToursPage() {
  return <div className="max-h-[calc(100dvh-5rem)] overflow-y-auto"><MarineApp view="crm" /></div>;
}
