import { Outlet } from "react-router-dom";

export function App() {
  return (
    <div className="shell">
      <header className="shell__header">
        <div>
          <p className="eyebrow">Monad DApp MVP</p>
          <h1>Collective MindGraph</h1>
        </div>
        <p className="shell__summary">
          Live text turns into a constrained debate tree, while canonical graph snapshots commit on-chain.
        </p>
      </header>
      <main className="shell__body">
        <Outlet />
      </main>
    </div>
  );
}
