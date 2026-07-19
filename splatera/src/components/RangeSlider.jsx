import React, { useMemo } from 'react';
import './RangeSlider.css';

export default function RangeSlider({
  min = 0,
  max = 100,
  steps,
  ticks: customTicks,
  value = 60,
  onChange,
  className = '',
}) {
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

  return (
    <div className={`range-slider-wrapper ${className}`}>
      <div className="range-slider-container">
        <div className="range-slider-track">
          <div className="range-slider-fill" style={{ width: `${percentage}%` }} />
          <div className="range-slider-ticks">
            {computedTicks.map((t, idx) => {
              const tickPct = ((t - tickMin) / (tickMax - tickMin)) * 100;
              return (
                <span
                  key={idx}
                  className="range-slider-tick"
                  style={{ left: `${tickPct}%` }}
                />
              );
            })}
          </div>
        </div>

        <div className="range-slider-thumb" style={{ left: `${percentage}%` }}>
          <span className="range-slider-swatch-tick" />
          <span className="range-slider-swatch-tick" />
          <span className="range-slider-swatch-tick" />
        </div>

        <input
          type="range"
          min={tickMin}
          max={tickMax}
          step={1}
          value={closestTick}
          onChange={handleChange}
          className="range-slider-input"
        />
      </div>
    </div>
  );
}
