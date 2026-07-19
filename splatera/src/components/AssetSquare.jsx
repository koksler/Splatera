import React from 'react';
import { Package } from 'lucide-react';
import './AssetSquare.css';

export default function AssetSquare({
  src,
  isVideo = false,
  isBlob = false,
  blobCount = 0,
  className = '',
}) {
  if (isBlob) {
    return (
      <div className={`asset-square is-blob ${className}`}>
        <Package size={15} />
        <span className="asset-square-blob-text">{blobCount}+</span>
      </div>
    );
  }

  return (
    <div className={`asset-square ${className}`}>
      {isVideo ? (
        <video
          src={src}
          className="asset-square-media"
          muted
          autoPlay
          loop
          playsInline
        />
      ) : (
        <img src={src} alt="thumbnail" className="asset-square-media" />
      )}
      <div className="asset-square-overlay" />
    </div>
  );
}
