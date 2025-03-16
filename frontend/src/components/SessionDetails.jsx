// In the SessionDetails component
return (
  <div className="session-details">
    <h2>{session.symbol} Trading Session</h2>
    <div className="stats">
      <div className="stat">
        <span className="label">Quantity:</span>
        <span className="value">{session.display_quantity} {session.symbol.replace('USDT', '')}</span>
      </div>
      <div className="stat">
        <span className="label">Current Price:</span>
        <span className="value">${session.display_price}</span>
      </div>
      <div className="stat">
        <span className="label">Current Value:</span>
        <span className="value">${session.display_value}</span>
      </div>
      <div className="stat">
        <span className="label">Profit/Loss:</span>
        <span className={`value ${session.profit_loss >= 0 ? 'profit' : 'loss'}`}>
          ${session.display_profit_loss} ({session.display_percentage}%)
        </span>
      </div>
    </div>
    {/* Rest of the component */}
  </div>
);