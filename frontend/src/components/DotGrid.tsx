export function DotGrid() {
  return (
    <div
      className="fixed inset-0 -z-10 pointer-events-none"
      style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, #0d1a2e 0%, #06090f 100%)' }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(30,58,95,0.45) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
    </div>
  )
}
