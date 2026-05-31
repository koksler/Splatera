import './label.css';

export default function Label({ text, isActive = true, onClick, className = '' }) {
  return (
    <div 
      className={`splatera-label ${!isActive ? 'inactive' : ''} ${className}`}
      onClick={onClick}
    >
      {text}
    </div>
  );
}