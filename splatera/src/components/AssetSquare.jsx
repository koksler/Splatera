import React from 'react';
import { Package, X } from 'lucide-react';
import Button from './button';
import './AssetSquare.css';

export default function AssetSquare({
  src,
  fallbackSrc,
  isVideo = false,
  isBlob = false,
  blobCount = 0,
  className = '',
  onClose,
}) {
  const [imgSrc, setImgSrc] = React.useState(src);

  React.useEffect(() => {
    setImgSrc(src);
  }, [src]);

  const handleImgError = () => {
    if (fallbackSrc && imgSrc !== fallbackSrc) {
      setImgSrc(fallbackSrc);
    }
  };

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
      {onClose && (
        <Button
          variant="tiny"
          icon={X}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="asset-square-close-btn"
        />
      )}
      {isVideo ? (
        <video
          src={imgSrc}
          className="asset-square-media"
          muted
          autoPlay
          loop
          playsInline
          onError={handleImgError}
        />
      ) : (
        <img
          src={imgSrc}
          alt="thumbnail"
          className="asset-square-media"
          onError={handleImgError}
        />
      )}
      <div className="asset-square-overlay" />
    </div>
  );
}

