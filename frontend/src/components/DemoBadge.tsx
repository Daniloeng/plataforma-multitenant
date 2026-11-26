export function DemoBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      className="badge badge--demo"
      title="Os dados exibidos são gerados no navegador pelo MSW."
    >
      Modo demo (API simulada)
    </span>
  );
}
