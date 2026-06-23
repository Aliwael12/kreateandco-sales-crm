interface Props {
  name: string
  phase: number
}

export default function ComingSoonPage({ name, phase }: Props) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md rounded-2xl border border-line bg-white px-10 py-12 text-center">
        <div className="font-display mb-2 text-[22px] font-bold text-ink-1">
          {name}
        </div>
        <p className="text-[13.5px] leading-relaxed text-ink-3">
          This page is part of <b className="text-ink-2">Phase {phase}</b> of
          the build. The foundation (auth, database, layout, security rules) is
          in place — this view will land next.
        </p>
      </div>
    </div>
  )
}
