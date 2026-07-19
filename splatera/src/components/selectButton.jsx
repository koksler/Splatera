import React from 'react';
import './selectButton.css';

export default function SelectButton({ icon: Icon, text, active, onClick, color, minimized = false, className = '' }) {
  const isMinimized = minimized || !text;

  return (
    <button
      className={`select-btn ${active ? 'active' : ''} ${isMinimized ? 'minimized' : ''} ${className}`}
      style={active ? { borderColor: color } : undefined}
      onClick={onClick}
    >
      <div
        className="select-btn-icon"
        style={active ? { backgroundColor: color } : undefined}
      >
        {Icon && <Icon size={15} strokeWidth={2} />}
      </div>
      {!isMinimized && text && <span>{text}</span>}
    </button>
  );
}
