'use client';

import * as React from 'react';
import { MessageItem } from '@/components/chat/message-item';
import { MessageActions } from '@/components/chat/message-actions';
import type { ChatMessage } from '@/lib/store/chat-store';

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  messagesEndRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

export function ChatMessages({
  messages,
  isLoading = false,
  messagesEndRef,
  className = '',
}: ChatMessagesProps) {
  return (
    <div className={`max-w-3xl w-full mx-auto flex flex-col ${className}`}>
      {messages.map((message, idx) => (
        <MessageItem
          key={message.id || idx}
          message={message}
          isStreaming={isLoading && idx === messages.length - 1}
        />
      ))}
      {messagesEndRef && <div ref={messagesEndRef} />}
    </div>
  );
}

export { MessageActions };
export default ChatMessages;
