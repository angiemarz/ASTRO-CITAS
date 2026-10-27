import { AtSign, MessageCircle, MessageCircleHeart, MoreHorizontal, Phone, Video } from 'lucide-react';
import type { Platform } from '../../shared/types';

// lucide-react ya no incluye logotipos de marcas; se usan íconos genéricos equivalentes.
export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  switch (platform) {
    case 'whatsapp':
      return <MessageCircle className={className} />;
    case 'messenger':
      return <MessageCircleHeart className={className} />;
    case 'instagram':
      return <AtSign className={className} />;
    case 'video':
      return <Video className={className} />;
    case 'phone':
      return <Phone className={className} />;
    default:
      return <MoreHorizontal className={className} />;
  }
}
