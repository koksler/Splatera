import React from 'react';
import './toggle.css';

export default function Toggle({ label, checked, onChange, disabled = false }) {
  const handleToggle = () => {
    if (disabled) return;
    onChange(!checked);
  };

  return (
    <div 
      className={`splatera-toggle-wrapper ${disabled ? 'disabled' : ''}`} 
      onClick={handleToggle}
    >
      <div className={`splatera-toggle-track ${checked ? 'active' : ''}`}>
        <div className={`splatera-toggle-thumb ${checked ? 'active' : ''}`} />
      </div>
      {label && <span className="splatera-toggle-label">{label}</span>}
    </div>
  );
}
