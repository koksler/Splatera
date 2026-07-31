import React, { useRef, useEffect, useState } from 'react';
import './input.css';
import { Tooltip } from './tooltip';
import Tag from './Tag';
import ColorPicker from './colorPicker';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useDismiss,
  useInteractions,
  FloatingFocusManager,
} from '@floating-ui/react';

const Input = React.forwardRef(({ 
  icon: Icon, 
  selectedTags = [], 
  selectedColors = [], 
  onRemoveTag, 
  onRemoveColor,
  tooltip,
  hotkey,
  tooltipPosition = 'bottom',
  showColorPicker = false,
  pickerColor,
  onPickerColorChange,
  ...props 
}, ref) => {
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

  // Set up floating UI for tag manager dropdown
  const { refs, floatingStyles, context } = useFloating({
    open: isTagManagerOpen,
    onOpenChange: setIsTagManagerOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ rects }) => {
        const headerEl = document.querySelector('.splatera-header');
        const refEl = refs.reference.current;
        if (headerEl && refEl && headerEl.contains(refEl)) {
          const headerRect = headerEl.getBoundingClientRect();
          const refRect = refEl.getBoundingClientRect();
          return (headerRect.bottom - refRect.bottom) + 10;
        }
        return 10;
      }),
      flip(),
      shift({ padding: 10 }),
    ],
  });

  const dismiss = useDismiss(context);
  const { getFloatingProps } = useInteractions([dismiss]);

  // Combine wrapper ref with floating-ui reference setter
  const setRef = (node) => {
    wrapperRef.current = node;
    refs.setReference(node);
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  };

  // Autoclose tag manager if there are less than 3 tags present in search
  useEffect(() => {
    if (selectedTags.length < 3 && isTagManagerOpen) {
      setIsTagManagerOpen(false);
    }
  }, [selectedTags, isTagManagerOpen]);

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
    <div className="splatera-input-wrapper" ref={setRef}>
      {Icon && <Icon size={15} className="input-icon" />}

      <input 
        ref={inputRef}
        className="splatera-input" 
        style={{ 
          paddingLeft: Icon ? '15px' : '10px', 
        }} 
        {...props} 
      />

      <div className="search-right-container">
        {/* Selected Color Search Swatch (no more than 1) */}
        {selectedColors.slice(0, 1).map((color, idx) => (
          <div 
            key={`color-${idx}`} 
            className="input-tag-color" 
            style={{ backgroundColor: color }}
            onClick={() => onRemoveColor && onRemoveColor(color)}
            title="Remove color filter"
          />
        ))}

        {/* Selected tags in the input field (at most 2) */}
        {selectedTags.slice(0, 1).map((tag, idx) => (
          <Tag 
            key={`tag-${idx}`} 
            tag={tag} 
            variant="input" 
            onRemove={onRemoveTag} 
          />
        ))}

        {/* If more than 2 tags are selected, show the +n button */}
        {selectedTags.length > 1 && (
          <button 
            type="button"
            className="tag-more-button"
            onClick={() => setIsTagManagerOpen(!isTagManagerOpen)}
          >
            +{selectedTags.length - 1}
          </button>
        )}

        {/* Nested ColorPicker */}
        {showColorPicker && (
          <ColorPicker
            color={pickerColor}
            onChange={onPickerColorChange}
            onOpenChange={setIsColorPickerOpen}
          />
        )}
      </div>

      {/* Tag manager dropdown menu */}
      {isTagManagerOpen && (
        <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
          <div 
            ref={refs.setFloating} 
            style={{ ...floatingStyles, zIndex: 10000 }} 
            {...getFloatingProps()} 
            className="extended-tag-dropdown"
          >
            {selectedTags.map((tag, idx) => (
              <Tag 
                key={`tag-dropdown-${idx}`} 
                tag={tag} 
                variant="dropdown" 
                onRemove={onRemoveTag} 
              />
            ))}
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );

  if (tooltip || hotkey) {
    return (
      <Tooltip 
        content={tooltip || 'Search'} 
        hotkey={hotkey} 
        position={tooltipPosition}
        disabled={isTagManagerOpen || isColorPickerOpen}
      >
        {inputContent}
      </Tooltip>
    );
  }

  return inputContent;
});

Input.displayName = 'Input';
export default Input;