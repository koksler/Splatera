import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useInteractions,
  FloatingFocusManager,
  size,
} from '@floating-ui/react';
import './PropertySelect.css';

export default function PropertySelect({
  options = [],
  value,
  onChange,
  placeholder = 'Select option...',
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(5),
      flip(),
      shift({ padding: 10 }),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
          });
        },
      }),
    ],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  const handleSelect = (optionValue) => {
    if (onChange) {
      onChange(optionValue);
    }
    setIsOpen(false);
  };

  const selectedOption = options.find(
    (opt) => (typeof opt === 'object' ? opt.value : opt) === value
  );
  const displayLabel = selectedOption
    ? typeof selectedOption === 'object'
      ? selectedOption.label
      : selectedOption
    : placeholder;

  const IconComponent = isOpen ? ChevronUp : ChevronDown;

  return (
    <div className={`property-select-wrapper ${className}`}>
      <div
        ref={refs.setReference}
        {...getReferenceProps()}
        className={`property-select-trigger ${isOpen ? 'is-open' : ''}`}
      >
        <span className="property-select-value">{displayLabel}</span>
        <span className="property-select-icon">
          <IconComponent size={15} />
        </span>
      </div>

      {isOpen && (
        <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="property-select-dropdown"
          >
            {options.map((opt) => {
              const optVal = typeof opt === 'object' ? opt.value : opt;
              const optLabel = typeof opt === 'object' ? opt.label : opt;
              const isSelected = optVal === value;

              return (
                <div
                  key={String(optVal)}
                  className={`property-select-option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => handleSelect(optVal)}
                >
                  {optLabel}
                </div>
              );
            })}
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );
}
