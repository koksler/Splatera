import { Copy, Maximize } from 'lucide-react';
import Button from './button';
import Label from './label';
import './cardPopup.css';

export default function CardPopup({ title, dateText, tags =[], onCopy, onMaximize, onManageTags }) {

  const visibleTags = tags.slice(0, 2);
  const hiddenTagsCount = tags.length - 2;

  return (
    <div className="splatera-card-popup">
      
      <div className="popup-info">
        <span className="popup-title">{title}</span>
        <span className="popup-date">{dateText}</span>
      </div>

      <div className="popup-actions">
        
        {/* Оборачиваем теги в кликабельный контейнер */}
        <div 
           onClick={onManageTags} 
           style={{ display: 'flex', gap: '6px', cursor: 'pointer' }}
           title="Click to manage tags"
        >
          {visibleTags.map((tag, index) => (
            <Label key={index} text={tag} isActive={true} /> 
          ))}

          {hiddenTagsCount > 0 && (
            <Label text={`+${hiddenTagsCount}`} isActive={true} />
          )}
        </div>

        <Button icon={Copy} onClick={onCopy} tooltip="Copy" tooltipPosition="bottom" />
        <Button icon={Maximize} onClick={onMaximize} tooltip="Open Lightbox" tooltipPosition="bottom" />
      </div>

    </div>
  );
}