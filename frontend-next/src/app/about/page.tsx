export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-14">
      <h1
        className="text-3xl font-bold mb-3 tracking-tight"
        style={{ color: "var(--text-primary)" }}
      >
        About PhytoDiscover
      </h1>
      <p className="text-base mb-10" style={{ color: "var(--text-secondary)" }}>
        A phytochemical-based drug discovery platform for researchers.
      </p>

      <div className="space-y-8">
        <Section title="What it does">
          <p>
            PhytoDiscover lets biologists and computational chemists screen
            plant-derived compounds against protein targets using molecular
            docking. Search a curated database of 12,000+ phytochemicals,
            configure one or more protein targets, and launch AutoDock Vina
            docking jobs — all from a single interface.
          </p>
        </Section>

        <Section title="How it works">
          <ol className="list-decimal list-inside space-y-2">
            <li>Search compounds by plant species name or compound name.</li>
            <li>Select the compounds you want to screen.</li>
            <li>
              Enter one or more protein targets (PDB or AlphaFold accession).
            </li>
            <li>
              Click &ldquo;Run Docking&rdquo; — a separate job is dispatched for
              each protein.
            </li>
            <li>
              View binding affinity scores and inspect 3D poses in the Results
              page.
            </li>
          </ol>
        </Section>

        <Section title="Data sources">
          <ul className="list-disc list-inside space-y-1">
            <li>
              Compound library: 12,663 unique phytochemicals from 4,010 plant
              species.
            </li>
            <li>
              Protein structures: RCSB PDB and AlphaFold Protein Structure
              Database.
            </li>
            <li>
              Molecular properties (MW, LogP, Lipinski rule-of-five) computed
              with RDKit.
            </li>
          </ul>
        </Section>

        <Section title="Technology stack">
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {[
              ["Backend", "FastAPI + SQLAlchemy"],
              ["Queue", "Celery + Redis"],
              ["Database", "PostgreSQL 16"],
              ["Docking engine", "AutoDock Vina"],
              ["Cheminformatics", "RDKit + MGLTools"],
              ["Frontend", "Next.js 14 + TypeScript"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg p-3"
                style={{
                  backgroundColor: "var(--bg-card)",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  className="text-[10px] font-semibold uppercase tracking-wider mb-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  {label}
                </div>
                <div
                  className="text-sm font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Notes for researchers">
          <ul className="list-disc list-inside space-y-1">
            <li>
              Docking scores are estimates of binding affinity — not experimental
              values.
            </li>
            <li>
              Scores more negative than −7 kcal/mol are typically considered
              moderate; below −9 is strong.
            </li>
            <li>
              SMILES strings must be valid for a compound to be dockable. The
              platform skips compounds without SMILES.
            </li>
            <li>
              Session data is stored per browser — clearing cookies resets your
              job history.
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2
        className="text-lg font-semibold mb-3"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </h2>
      <div
        className="text-sm leading-relaxed space-y-2"
        style={{ color: "var(--text-secondary)" }}
      >
        {children}
      </div>
    </div>
  );
}
