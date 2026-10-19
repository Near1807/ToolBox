export function HomePage() {
  return (
    <div className="page">
      <header className="page__header">
        <h1>Accueil</h1>
        <p className="muted">Tous tes outils, regroupés par section.</p>
      </header>
      <div className="empty-state">
        <p>Aucun outil installé pour l’instant.</p>
        <p className="muted">Les modules ajoutés au dossier « modules » apparaîtront ici.</p>
      </div>
    </div>
  );
}
