export function SegControl({ options, value }: { options: string[]; value: string }) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button key={option} className={option === value ? 'on' : undefined}>
          {option}
        </button>
      ))}
    </div>
  )
}
