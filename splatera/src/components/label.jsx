import React from 'react';
import { X } from 'lucide-react';
import './label.css';

export default function Label({ text, isActive = true, editable = false, onRemove, onClick, className = '' }) {
  const handleRemove = (e) => {
    e.stopPropagation();
    if (onRemove) {
      onRemove();
    }
  };

  const displayText = typeof text === 'string' && text.length > 20
    ? text.slice(0, 20) + '...'
    : text;

  return (
    <div 
      className={`splatera-label ${!isActive ? 'inactive' : ''} ${editable ? 'editable' : ''} ${className}`}
      onClick={onClick}
    >
      <span>{displayText}</span>
      {editable && (
        <X 
          size={15} 
          className="splatera-label-remove" 
          onClick={handleRemove}
        />
      )}
    </div>
  );
}