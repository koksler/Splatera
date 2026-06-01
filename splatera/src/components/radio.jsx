import React from 'react';
import './radio.css';

export default function Radio({ checked, ...props }) {
  return (
    <div className={`splatera-radio ${checked ? 'checked' : ''}`} {...props}>
      {checked ? (
        <span className="radio-inner-circle" />
      ) : (
        <span className="radio-inner-line" />
      )}
    </div>
  );
}
