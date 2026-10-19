// Frontend of youtube-video: track picker, preview, render, description.
import { defineFrontendModule } from '@hub/sdk/frontend';
import { YouTubePage } from './YouTubePage';
import './youtube.css';

export default defineFrontendModule({
  pages: [{ path: '', component: YouTubePage }],
});
