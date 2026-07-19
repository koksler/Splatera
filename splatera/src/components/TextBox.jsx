import React from 'react';
import './TextBox.css';

const TextBox = React.forwardRef(({ children, className = '', ...props }, ref) => {
  return (
    <div ref={ref} className={`splatera-textbox ${className}`} {...props}>
      {children}
    </div>
  );
});

TextBox.displayName = 'TextBox';

export default TextBox;
