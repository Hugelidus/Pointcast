interface HeaderBarProps {
  title: string;
}

export function HeaderBar({ title }: HeaderBarProps) {
  return (
    <header className="header-bar">
      <h1>{title}</h1>
      <div className="header-actions">
        <span className="header-user">Ana Ríos</span>
      </div>
    </header>
  );
}
