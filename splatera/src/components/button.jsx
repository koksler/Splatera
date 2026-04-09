import React from 'react';
import './button.css';
import { Tooltip } from './tooltip';

const Button = React.forwardRef(({ 
  icon: Icon, 
  text, 
  onClick, 
  className = '', 
  tooltip, 
  hotkey, 
  tooltipPosition = 'bottom',
  ...props 
}, ref) => {
  const modeClass = text ? 'with-text' : 'icon-only';

  const buttonContent = (
    <button 
      ref={ref}
      className={`splatera-btn ${modeClass} ${className}`} 
      onClick={onClick}
      {...props}
    >
      {Icon && <Icon size={15} strokeWidth={2} />}
      
      {text && <span>{text}</span>}
    </button>
  );

  if (tooltip) {
    return (
      <Tooltip content={tooltip} hotkey={hotkey} position={tooltipPosition}>
        {buttonContent}
      </Tooltip>
    );
  }

  return buttonContent;
});

Button.displayName = 'Button';
export default Button;