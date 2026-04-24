interface ScoreMeterProps {
  score: number;
  label?: string;
}

export function ScoreMeter({ score, label }: ScoreMeterProps) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="score-meter" aria-label={label ?? `Score ${clamped} of 100`}>
      <div
        className="score-meter-fill"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ width: `${clamped}%` }}
      />
      <span className="score-meter-value">{clamped}</span>
    </div>
  );
}
