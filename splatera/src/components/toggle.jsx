import React, { useState, useRef, useEffect } from 'react';
import './toggle.css';

export default function Toggle({ label, checked, onChange, disabled = false }) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragLeft, setDragLeft] = useState(checked ? 25.5 : 1.5);
  const startXRef = useRef(0);
  const startLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);

  // Sync state if checked prop changes when not dragging
  useEffect(() => {
    if (!isDragging) {
      setDragLeft(checked ? 25.5 : 1.5);
    }
  }, [checked, isDragging]);

  const handlePointerDown = (e) => {
    if (disabled) return;
    e.stopPropagation();
    setIsDragging(true);
    hasDraggedRef.current = false;
    startXRef.current = e.clientX;
    startLeftRef.current = checked ? 25.5 : 1.5;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    const deltaX = e.clientX - startXRef.current;
    if (Math.abs(deltaX) > 3) {
      hasDraggedRef.current = true;
    }
    const newLeft = Math.max(1.5, Math.min(25.5, startLeftRef.current + deltaX));
    setDragLeft(newLeft);
  };

  const handlePointerUp = (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (hasDraggedRef.current) {
      const newState = dragLeft > 13.5;
      setDragLeft(newState ? 25.5 : 1.5);
      if (newState !== checked) {
        onChange(newState);
      }
    }
  };

  const handleWrapperClick = (e) => {
    if (disabled) return;
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      return;
    }
    onChange(!checked);
  };

  const thumbStyle = {
    transform: `translateX(${dragLeft - 1.5}px)`,
    transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s ease',
  };

  return (
    <div 
      className={`splatera-toggle-wrapper ${disabled ? 'disabled' : ''}`} 
      onClick={handleWrapperClick}
    >
      <div className={`splatera-toggle-track ${checked ? 'active' : ''}`}>
        <div className={`splatera-toggle-line ${checked ? 'active' : ''}`} />
        <div 
          className={`splatera-toggle-thumb ${checked ? 'active' : ''}`}
          style={thumbStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      {label && <span className="splatera-toggle-label">{label}</span>}
    </div>
  );
}
