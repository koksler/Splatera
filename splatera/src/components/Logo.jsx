export default function Logo({ className = '', size = 35 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.5" y="0.5" width="35" height="35" rx="6" fill="#120F0D" />
      <rect x="0.5" y="0.5" width="35" height="35" rx="6" stroke="#FFC95E" strokeMiterlimit="10" />
      <path d="M6.7207 7.30176H19.9062V14.1336C22.1443 14.3238 24.3477 14.6179 26.5164 14.9984C26.5511 16.8317 26.6725 18.6651 26.8807 20.4638C27.193 23.3176 27.7135 26.1195 28.4248 28.835C25.6663 28.1431 22.8209 27.6243 19.9236 27.3302C18.154 27.1573 16.3496 27.0535 14.5453 27.0362C14.1462 24.8742 13.834 22.6777 13.6431 20.4465H6.73806V7.30176H6.7207Z" fill="#FFD16D" />
    </svg>

  );
}