import React from 'react';
import AssetModals from './AssetModals';

export default function ImportModal({ paths, hasTemp, onConfirm, onClose }) {
  return (
    <AssetModals
      mode="import"
      assets={paths}
      hasTemp={hasTemp}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}