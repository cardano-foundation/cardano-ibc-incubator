import { ReactNode } from 'react';
import CardStyle from './index.style';

interface CardProps {
  children: ReactNode;
}

export default function Card({ children }: CardProps) {
  return <CardStyle>{children}</CardStyle>;
}
