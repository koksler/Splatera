import React, { useRef, useEffect, useState } from 'react';
import './SegmentedControl.css';

export default function SegmentedControl({
  options = ['Light', 'Dark', 'System'],
  value,
  onChange,
  className = '',
}) {
  const selectedIndex = options.findIndex(
    (opt) => (typeof opt === 'object' ? opt.value : opt) === value
  );
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const [indicatorStyle, setIndicatorStyle] = useState({});
  const containerRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, options.length);
    const updateIndicator = () => {
      const activeItem = itemRefs.current[activeIndex];
      if (activeItem) {
        setIndicatorStyle({
          left: `${activeItem.offsetLeft}px`,
          width: `${activeItem.offsetWidth}px`,
        });
      }
    };

    updateIndicator();

    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateIndicator);
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    }
  }, [activeIndex, options, value]);

  const handleSelect = (optVal) => {
    if (onChange) {
      onChange(optVal);
    }
  };

  return (
    <div ref={containerRef} className={`segmented-control-container ${className}`}>
      <div className="segmented-control-indicator" style={indicatorStyle} />

      {options.map((opt, idx) => {
        const optVal = typeof opt === 'object' ? opt.value : opt;
        const optLabel = typeof opt === 'object' ? opt.label : opt;
        const isActive = idx === activeIndex;

        return (
          <button
            key={String(optVal)}
            ref={(el) => (itemRefs.current[idx] = el)}
            type="button"
            className={`segmented-control-item ${isActive ? 'is-active' : ''}`}
            onClick={() => handleSelect(optVal)}
          >
            {optLabel}
          </button>
        );
      })}
    </div>
  );
}
