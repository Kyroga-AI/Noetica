export function Sidebar() {
  return (
    <aside className="hidden w-72 shrink-0 border-r border-noetica-line bg-noetica-light/60 p-5 lg:block">
      <div className="mb-8">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">SocioProphet</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Noetica</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Governed chat for SourceOS-grade reasoning surfaces.</p>
      </div>

      <button className="w-full rounded-2xl border border-blue-200 bg-white px-4 py-3 text-left text-sm font-medium text-blue-700 shadow-shell">
        New governed chat
      </button>

      <div className="mt-8 space-y-2">
        {['M1 scaffold review', 'Steering baseline', 'SourceOS adapter'].map((item) => (
          <div key={item} className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm text-slate-700">
            {item}
          </div>
        ))}
      </div>

      <div className="absolute bottom-5 left-5 right-auto w-60 rounded-2xl border border-blue-100 bg-white p-3 text-xs text-slate-500">
        Session-local. Memory writes disabled until memory-mesh integration lands.
      </div>
    </aside>
  )
}
