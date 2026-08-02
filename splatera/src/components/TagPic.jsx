import React, { memo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import './TagPic.css';

function TagPic({ tag, count, previewPath, width, onClick }) {
  const formattedCount = count > 999 ? '999+' : String(count);
  const bgUrl = previewPath ? convertFileSrc(previewPath) : null;

  return (
    <div
      className="tag-pic"
      style={{ width: '100%' }}
      onClick={() => onClick && onClick(tag)}
    >
      {bgUrl && (
        <div
          className="tag-pic-bg"
          style={{ backgroundImage: `url("${bgUrl}")` }}
        />
      )}
      <div className="tag-pic-dim" />
      <div className="tag-pic-count">{formattedCount}</div>
      <div className="tag-pic-title">{tag}</div>
    </div>
  );
}

export default memo(TagPic);
