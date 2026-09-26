import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export function RenderedMarkdown({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="rendered-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
