import { useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
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
import Radio from './radio';
import './sortMenu.css';

export default function SortMenu({ sortOrder, setSortOrder, snapHeader }) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ rects }) => {
        const headerEl = document.querySelector('.splatera-header');
        const buttonEl = refs.reference.current;
        if (headerEl && buttonEl && headerEl.contains(buttonEl)) {
          const headerRect = headerEl.getBoundingClientRect();
          const buttonRect = buttonEl.getBoundingClientRect();
          return (headerRect.bottom - buttonRect.bottom) + 10;
        }
        return snapHeader ? 30 : 20;
      }),
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
            {/* Option 1: Newest first */}
            <div className="sort-option-row">
              <span>Newest first</span>
              <Radio 
                checked={sortOrder === 'date_desc'} 
                onClick={() => handleSortSelect('date_desc')}
              />
            </div>

            {/* Option 2: Ascending by Name */}
            <div className="sort-option-row">
              <span>Ascending by Name</span>
              <Radio 
                checked={sortOrder === 'name_asc'} 
                onClick={() => handleSortSelect('name_asc')}
              />
            </div>

            {/* Option 3: Descending by Name */}
            <div className="sort-option-row">
              <span>Descending by Name</span>
              <Radio 
                checked={sortOrder === 'name_desc'} 
                onClick={() => handleSortSelect('name_desc')}
              />
            </div>
            
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}