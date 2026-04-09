import React, { useRef, useEffect, useState } from 'react';
import './input.css';
import { Tooltip } from './tooltip';

const Input = React.forwardRef(({ 
  icon: Icon, 
  selectedTags = [], 
  selectedColors = [], 
  onRemoveTag, 
  onRemoveColor,
  tooltip,
  hotkey,
  tooltipPosition = 'bottom',
  ...props 
}, ref) => {
  const tagsRef = useRef(null);
  const inputRef = useRef(null);
  const [dynamicPadding, setDynamicPadding] = useState(12);

  useEffect(() => {
    const el = tagsRef.current;
    if (!el) return;

    const update = () => {
      const w = el.offsetWidth;
      setDynamicPadding(w > 0 ? w + 24 : 12);
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [selectedTags, selectedColors]);

  useEffect(() => {
    if (!hotkey) return;

    const handleKeyDown = (e) => {
      if (
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.isContentEditable
      ) {
        return;
      }

      if (e.key.toLowerCase() === hotkey.toLowerCase()) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkey]);


  const inputContent = (
    <div className="splatera-input-wrapper" ref={ref}>
      <div className="search-tags-container" ref={tagsRef}>
        {selectedColors.map((color, idx) => (
          <div 
            key={`color-${idx}`} 
            className="input-tag-color" 
            style={{ backgroundColor: color }}
            onClick={() => onRemoveColor && onRemoveColor(color)}
            title="Убрать цвет"
          />
        ))}

        {selectedTags.map((tag, idx) => (
          <div key={`tag-${idx}`} className="input-tag-text">
            <span>{tag}</span>
            <button 
              type="button" 
              onClick={() => onRemoveTag && onRemoveTag(tag)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <input 
        ref={inputRef}
        className="splatera-input" 
        style={{ paddingLeft: `${dynamicPadding}px` }} 
        {...props} 
      />
      {Icon && <Icon size={16} className="input-icon" />}
    </div>
  );

  if (tooltip || hotkey) {
    return (
      <Tooltip content={tooltip || 'Search'} hotkey={hotkey} position={tooltipPosition}>
        {inputContent}
      </Tooltip>
    );
  }

  return inputContent;
});

Input.displayName = 'Input';
export default Input;