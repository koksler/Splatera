import React, { useState, useMemo } from 'react';
import { Tooltip } from './tooltip';
import './RangeSlider.css';

export default function RangeSlider({
  min = 0,
  max = 100,
  steps,
  ticks: customTicks,
  value = 60,
  onChange,
  className = '',
  formatTooltip,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // Compute ticks array:
  // Use customTicks if provided, otherwise compute from steps (default 5 steps if neither is passed)
  const computedTicks = useMemo(() => {
    if (Array.isArray(customTicks) && customTicks.length > 0) {
      return customTicks;
    }
    const numSteps = steps && steps > 0 ? steps : 5;
    const stepSize = (max - min) / numSteps;
    const result = [];
    for (let i = 0; i <= numSteps; i++) {
      result.push(min + i * stepSize);
    }
    return result;
  }, [customTicks, steps, min, max]);

  const tickMin = computedTicks[0] ?? min;
  const tickMax = computedTicks[computedTicks.length - 1] ?? max;

  // Find nearest tick to current value
  const closestTick = computedTicks.reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  );

  const percentage = Math.min(
    100,
    Math.max(0, ((closestTick - tickMin) / (tickMax - tickMin)) * 100)
  );

  const handleChange = (e) => {
    const rawVal = Number(e.target.value);
    const snappedVal = computedTicks.reduce((prev, curr) =>
      Math.abs(curr - rawVal) < Math.abs(prev - rawVal) ? curr : prev
    );

    if (onChange && snappedVal !== value) {
      onChange(snappedVal);
    }
  };

  const tooltipContent = formatTooltip ? formatTooltip(closestTick) : null;

  return (
    <div className={`range-slider-wrapper ${className}`}>
      <div
        className="range-slider-container"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          setIsDragging(false);
        }}
      >
        <div className="range-slider-track">
          <div className="range-slider-fill" style={{ width: `calc(10px + (100% - 20px) * ${percentage / 100})` }} />
          <div className="range-slider-ticks">
            {computedTicks.map((t, idx) => {
              const tickPct = ((t - tickMin) / (tickMax - tickMin)) * 100;
              return (
                <span
                  key={idx}
                  className="range-slider-tick"
                  style={{ left: `calc(10px + (100% - 20px) * ${tickPct / 100})` }}
                />
              );
            })}
          </div>
        </div>

        {tooltipContent ? (
          <Tooltip
            content={tooltipContent}
            position="top"
            open={(isHovered || isDragging) && Boolean(tooltipContent)}
          >
            <div className="range-slider-thumb" style={{ left: `calc(10px + (100% - 20px) * ${percentage / 100})` }}>
              <span className="range-slider-swatch-tick" />
              <span className="range-slider-swatch-tick" />
              <span className="range-slider-swatch-tick" />
            </div>
          </Tooltip>
        ) : (
          <div className="range-slider-thumb" style={{ left: `calc(10px + (100% - 20px) * ${percentage / 100})` }}>
            <span className="range-slider-swatch-tick" />
            <span className="range-slider-swatch-tick" />
            <span className="range-slider-swatch-tick" />
          </div>
        )}

        <input
          type="range"
          min={tickMin}
          max={tickMax}
          step={1}
          value={closestTick}
          onChange={handleChange}
          onPointerDown={() => setIsDragging(true)}
          onPointerUp={() => setIsDragging(false)}
          onFocus={() => setIsHovered(true)}
          onBlur={() => {
            setIsHovered(false);
            setIsDragging(false);
          }}
          className="range-slider-input"
        />
      </div>
    </div>
  );
}
