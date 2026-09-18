import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { ContentCopy } from '@mui/icons-material';

const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
  tagNames: (defaultSchema.tagNames || []).filter((name) => name !== 'script' && name !== 'iframe'),
};

function heading(variant) {
  return function Heading({ children }) {
    return (
      <Typography variant={variant} sx={{ fontWeight: 700, mt: 1, mb: 0.5, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    );
  };
}

function CodeBlock({ children, className }) {
  const [copied, setCopied] = useState(false);
  const text = String(children || '').replace(/\n$/, '');
  return (
    <Box sx={{ position: 'relative', my: 0.75, maxWidth: '100%' }}>
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton
          size="small"
          aria-label="Copy code"
          onClick={() => {
            navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          sx={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}
        >
          <ContentCopy sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
      <Box
        component="pre"
        className={className}
        sx={{
          m: 0,
          p: 1.25,
          pr: 4,
          borderRadius: 1,
          bgcolor: 'action.hover',
          overflowX: 'auto',
          fontSize: '0.75rem',
          lineHeight: 1.5,
          whiteSpace: 'pre',
        }}
      >
        <code>{text}</code>
      </Box>
    </Box>
  );
}

class MarkdownErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, source: props.source };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.source !== state.source) return { failed: false, source: props.source };
    return null;
  }

  render() {
    if (this.state.failed) {
      return (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
          {this.props.source}
        </Typography>
      );
    }
    return this.props.children;
  }
}

function PlainMarkdown({ source }) {
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
      {source}
    </Typography>
  );
}

export default function ChatMarkdown({ children }) {
  const source = children == null ? '' : String(children);
  if (!source.trim()) return null;
  try {
    return (
      <MarkdownErrorBoundary source={source}>
        <Box
          sx={{
            '& p': { m: 0, mb: 0.8, fontSize: '0.875rem', lineHeight: 1.7, overflowWrap: 'anywhere' },
            '& li': { fontSize: '0.875rem', lineHeight: 1.6, overflowWrap: 'anywhere' },
            '& blockquote': {
              m: 0,
              pl: 1.25,
              borderLeft: '3px solid',
              borderColor: 'divider',
              color: 'text.secondary',
            },
            '& a': { overflowWrap: 'anywhere', wordBreak: 'break-all' },
            '& table': { display: 'block', width: 'max-content', maxWidth: '100%', overflowX: 'auto' },
            '& th, & td': { px: 0.75, py: 0.4, border: '1px solid', borderColor: 'divider', fontSize: '0.75rem' },
            '& code': {
              fontSize: '0.78em',
              px: 0.4,
              borderRadius: 0.5,
              bgcolor: 'action.hover',
              overflowWrap: 'anywhere',
            },
            '& pre code': { bgcolor: 'transparent', px: 0 },
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeSanitize, schema]]}
            skipHtml
            components={{
              h1: heading('subtitle2'),
              h2: heading('subtitle2'),
              h3: heading('body1'),
              h4: heading('body2'),
              h5: heading('body2'),
              h6: heading('caption'),
              p: ({ children: nodes }) => (
                <Typography variant="body2" sx={{ mb: 0.8, lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                  {nodes}
                </Typography>
              ),
              a: ({ href, children: nodes }) => (
                <a href={href} target="_blank" rel="noreferrer noopener">{nodes}</a>
              ),
              pre: ({ children: nodes }) => nodes,
              code: ({ className, children: nodes }) => {
                const text = String(nodes ?? '');
                const isBlock = Boolean(className) || text.includes('\n');
                return isBlock
                  ? <CodeBlock className={className}>{nodes}</CodeBlock>
                  : <code className={className}>{nodes}</code>;
              },
            }}
          >
            {source}
          </ReactMarkdown>
        </Box>
      </MarkdownErrorBoundary>
    );
  } catch {
    return <PlainMarkdown source={source} />;
  }
}
