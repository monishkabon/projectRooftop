import './CornerBrackets.css';

export default function CornerBrackets() {
  return (
    <>
      <div className="corner-bracket corner-bracket--tl" aria-hidden="true" />
      <div className="corner-bracket corner-bracket--tr" aria-hidden="true" />
      <div className="corner-bracket corner-bracket--bl" aria-hidden="true" />
      <div className="corner-bracket corner-bracket--br" aria-hidden="true" />
    </>
  );
}
