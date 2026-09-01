import React from 'react';
import './textField.css';

const TextField = React.forwardRef(({ className = '', style, ...props }, ref) => {
  return (
    <div className={`splatera-textfield-wrapper ${className}`} style={style}>
      <input
        ref={ref}
        className="splatera-textfield"
        {...props}
      />
    </div>
  );
});

TextField.displayName = 'TextField';

export default TextField;
