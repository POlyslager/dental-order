import { ArrowLeft } from 'lucide-react'

interface Props { onBack: () => void }

export default function TermsPage({ onBack }: Props) {
  return (
    <div className="min-h-full bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-800 p-1 -ml-1 shrink-0">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-semibold text-slate-800">Rechtliches</h1>
      </div>

      <div className="max-w-2xl mx-auto p-4 pb-24 space-y-6">

        <Section title="Nutzungsbedingungen">
          <p>Diese Anwendung (DentalOrder) dient der internen Lagerverwaltung und Bestellabwicklung der Zahnarztpraxis. Die Nutzung ist ausschließlich autorisierten Mitarbeitenden vorbehalten.</p>
          <p>Mit der Nutzung der Anwendung erklären Sie sich mit diesen Nutzungsbedingungen einverstanden.</p>
        </Section>

        <Section title="Nutzungspflichten">
          <ul>
            <li>Die Zugangsdaten sind vertraulich zu behandeln und dürfen nicht an Dritte weitergegeben werden.</li>
            <li>Bestandsänderungen, Bestellungen und Scans sind wahrheitsgemäß und zeitnah einzutragen.</li>
            <li>Festgestellte Fehler oder Unregelmäßigkeiten sind unverzüglich der Praxisleitung zu melden.</li>
            <li>Die missbräuchliche Nutzung der Anwendung ist untersagt und kann arbeitsrechtliche Konsequenzen haben.</li>
          </ul>
        </Section>

        <Section title="Haftungsausschluss">
          <p>Die Anwendung wird intern bereitgestellt und ohne ausdrückliche oder stillschweigende Gewährleistung zur Verfügung gestellt. Die Praxisleitung übernimmt keine Haftung für Datenverluste, fehlerhafte Bestände oder Unterbrechungen des Dienstes.</p>
          <p>Bestellentscheidungen, die auf Grundlage der in der Anwendung angezeigten Daten getroffen werden, liegen in der Verantwortung der handelnden Person.</p>
        </Section>

        <Section title="Datenschutz">
          <p>Im Rahmen der Nutzung werden folgende personenbezogene Daten verarbeitet:</p>
          <ul>
            <li><strong>E-Mail-Adresse</strong> – zur Authentifizierung und Kontaktzwecken</li>
            <li><strong>Nutzungsaktivitäten</strong> – Scans, Bestellungen und Lageränderungen werden dem jeweiligen Nutzerkonto zugeordnet und gespeichert</li>
            <li><strong>Push-Benachrichtigungen</strong> – bei Aktivierung wird ein Abonnement-Token auf dem Server gespeichert</li>
          </ul>
          <p>Die Daten werden ausschließlich zum Betrieb der Lagerverwaltung verwendet und nicht an Dritte weitergegeben. Die Datenspeicherung erfolgt über Supabase (EU-Region). Es gelten die Datenschutzbestimmungen gemäß DSGVO.</p>
          <p>Sie haben das Recht auf Auskunft, Berichtigung und Löschung Ihrer gespeicherten Daten. Wenden Sie sich hierfür an die Praxisleitung.</p>
        </Section>

        <Section title="Änderungen">
          <p>Die Praxisleitung behält sich vor, diese Bedingungen jederzeit zu ändern. Wesentliche Änderungen werden den Nutzenden mitgeteilt.</p>
        </Section>

        <p className="text-xs text-slate-400 pt-2">Stand: {new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      <div className="text-sm text-slate-600 space-y-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-1">
        {children}
      </div>
    </div>
  )
}
