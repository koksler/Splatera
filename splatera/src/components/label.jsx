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

  return (
    <div 
      className={`splatera-label ${!isActive ? 'inactive' : ''} ${editable ? 'editable' : ''} ${className}`}
      onClick={onClick}
    >
      <span>{text}</span>
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