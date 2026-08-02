import React from 'react';
import './GrayBox.css';

export function GrayBox({ children }) {
  return (
    <div className="gray-box">
      {children}
    </div>
  );
}

export function SettingRow({ title, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-row-left">
        <h3 className="setting-row-title">{title}</h3>
        {description && <p className="setting-row-desc">{description}</p>}
      </div>
      <div className="setting-row-right">
        {children}
      </div>
    </div>
  );
}
