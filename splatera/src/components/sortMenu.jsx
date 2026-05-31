import { useState } from 'react';
import { ArrowUpDown, SortAsc, SortDesc, Clock } from 'lucide-react'; // Icons for sorting
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  FloatingFocusManager,
} from '@floating-ui/react';

import Button from './button';
import './sortMenu.css';

export default function SortMenu({ sortOrder, setSortOrder }) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip(),
      shift({ padding: 12 }),
    ],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  // Handler to update the sort order
  const handleSortSelect = (sortType) => {
    setSortOrder(sortType);
    setIsOpen(false);
  };

  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()}>
        <Button icon={ArrowUpDown} text="Sort" />
      </div>

      {isOpen && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="sort-popover"
          >
            <div className="sort-section-title">Sort by</div>

            {/* Option 1: Date (Newest first) */}
            <Button 
              icon={Clock} 
              text="Newest first" 
              className={`sort-option-btn ${sortOrder === 'date_desc' ? 'active' : ''}`}
              onClick={() => handleSortSelect('date_desc')}
            />

            {/* Option 2: Name (A-Z) */}
            <Button 
              icon={SortAsc} 
              text="Name (A - Z)" 
              className={`sort-option-btn ${sortOrder === 'name_asc'  ? 'active' : ''}`}
              onClick={() => handleSortSelect('name_asc')}
            />

            {/* Option 3: Name (Z-A) */}
            <Button 
              icon={SortDesc} 
              text="Name (Z - A)" 
              className={`sort-option-btn ${sortOrder === 'name_desc' ? 'active' : ''}`}
              onClick={() => handleSortSelect('name_desc')}
            />
            
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}