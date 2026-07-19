import React from 'react';
import './button.css';
import { Tooltip } from './tooltip';

const Button = React.forwardRef(({ 
  icon: Icon, 
  text, 
  variant,
  onClick, 
  className = '', 
  tooltip, 
  hotkey, 
  tooltipPosition = 'bottom',
  ...props 
}, ref) => {
  const isTiny = variant === 'tiny';
  const modeClass = isTiny ? 'tiny' : (text ? 'with-text' : 'icon-only');
  const iconSize = isTiny ? 9 : 15;
  const iconStroke = isTiny ? 1.5 : 2;

  const buttonContent = (
    <button 
      ref={ref}
      className={`splatera-btn ${modeClass} ${className}`} 
      onClick={onClick}
      {...props}
    >
      {Icon && <Icon size={iconSize} strokeWidth={iconStroke} />}
      
      {!isTiny && text && <span>{text}</span>}
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