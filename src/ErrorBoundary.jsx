import { Component, Fragment } from 'react'

// Stops one broken component from blanking the whole page. React unmounts the entire tree on an uncaught
// render error, which looks like "the page went blank". This catches it, shows a small note, and lets the
// reader retry without losing the rest of the app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, key: 0 }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // keep the details in the console for debugging; the UI stays friendly
    console.error('AraLab UI error:', error, info?.componentStack)
  }

  retry = () => this.setState(s => ({ error: null, key: s.key + 1 }))

  render() {
    if (!this.state.error) return <Fragment key={this.state.key}>{this.props.children}</Fragment>
    if (this.props.compact) {
      return (
        <div className="ui-error compact" role="alert">
          <small>This part couldn’t load.</small>
          <button type="button" className="link-btn" onClick={this.retry}>Try again</button>
        </div>
      )
    }
    return (
      <div className="ui-error tile clay" role="alert">
        <b>Something went wrong here.</b>
        <p className="mute">{String(this.state.error?.message || this.state.error || 'Unknown error')}</p>
        <button type="button" className="btn pri" onClick={this.retry}>Try again</button>
      </div>
    )
  }
}
