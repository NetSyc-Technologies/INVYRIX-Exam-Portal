import { CSSProperties } from 'react';
import { useInstitute } from '../context/InstituteContext';
export default function Logo({ size = 48, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
    const { institute } = useInstitute();
    return <img src={institute?.logoUrl || '/logo.png'} alt={institute?.name || 'INVYRIX'} width={size} height={size} className={className} style={{ objectFit: 'contain', ...style }} onError={event => { if (!event.currentTarget.src.endsWith('/logo.png')) event.currentTarget.src = '/logo.png'; }} />;
}
