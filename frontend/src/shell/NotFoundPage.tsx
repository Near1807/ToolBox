import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="page">
      <h1>Page introuvable</h1>
      <p>
        <Link to="/">Retour à l’accueil</Link>
      </p>
    </div>
  );
}
