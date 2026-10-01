import React, { memo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import './SearchSwatch.css';

function SearchSwatch({
  icon: Icon,
  text = '',
  previewPath = null,
  color = null,
  onClick,
}) {
  const truncatedText = text.length > 8 ? `${text.slice(0, 8)}...` : text;
  const imageSrc = previewPath ? convertFileSrc(previewPath) : null;

  return (
    <div
      className="search-swatch"
      onClick={onClick}
      title={text}
    >
      <div className="search-swatch-content">
        {Icon && <Icon size={15} className="search-swatch-icon" />}
        <span className="search-swatch-text">{truncatedText}</span>
      </div>

      {color ? (
        <div
          className="search-swatch-color"
          style={{ backgroundColor: color }}
        />
      ) : imageSrc ? (
        <img
          src={imageSrc}
          alt={text}
          className="search-swatch-image"
          loading="lazy"
        />
      ) : null}
    </div>
  );
}

export default memo(SearchSwatch);
