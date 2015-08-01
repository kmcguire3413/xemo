<?xml version="1.0" encoding="UTF-8"?>

<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">

<xsl:template match="/">
    <html>
        <head>
            <link rel="stylesheet" type="text/css" href="http://kmcg3413.net/fcal/themes/default/plugreport_timesheet.css"/>
        </head>
        <body>
            <div class="cont">
                <div class="title"><b>Biweekly Time Sheet</b></div>
                <div class="subtitle"><b>Eclectic EMS</b></div>
                <div class="address">
                    PO BOX 240430<br/>
                    Eclectic, AL<br/>
                    36024<br/>
                </div>
                <table class="table">
                    <thead style="cell-padding: 5px;">
                        <tr>
                            <td style="width: .86in;">Day</td>
                            <td style="width: .65in;">Date</td>
                            <td style="width: .73in;">Regular Hours</td>
                            <td style="width: .67in;">Efficiency Hours $6.00</td>
                            <td style="width: .80in;">Volunteer $2</td>
                            <td style="width: .57in;">Sick</td>
                            <td style="width: .68in;">Vacation</td>
                            <td style="wdith: .72in;">Holiday</td>
                            <td style="width: .64in;">Total</td>
                        </tr>
                    </thead>
                    <tbody>
                        <xsl:for-each select="report/day">
                            <tr>
                                <td class="daycol"><xsl:value-of select="dayName"/></td>
                                <td class="monthcol"><xsl:value-of select="month"/>-<xsl:value-of select="day"/></td>
                                <td class="reghrcol"><xsl:value-of select="regularHours"/></td>
                                <td class="effhrcol"><xsl:value-of select="effHours"/></td>
                                <td class="inchrcol"><xsl:value-of select="incHours"/></td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td class="daytotalcol"><xsl:value-of select="dayTotal"/></td>
                            </tr>
                        </xsl:for-each>
                        <tr>
                            <td></td><td><b>Total</b></td>
                            <td><xsl:value-of select="report/total/regularHours"/></td>
                            <td><xsl:value-of select="report/total/effHours"/></td>
                            <td><xsl:value-of select="report/total/incHours"/></td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td><xsl:value-of select="report/total/allHours"/></td>
                        </tr>
                    </tbody>
                </table>
                <div class="pprangesection">Pay period start date:<br/>Pay period end date:</div>
                <div class="positionsection">Employee Position:    DRIVER</div>
                <div class="signaturesection">
                    <br/><br/>
                    <svg height="3" width="4.5in"><line x1="0" y1="0" x2="4.5in" y2="0" style="stroke: rgb(0, 0, 0); stroke-width: 2;"></line></svg><br/>Employee Signature<br/><svg height="3" width="4.5in"><line x1="0" y1="0" x2="4.5in" y2="0" style="stroke: rgb(0, 0, 0); stroke-width: 2;"></line></svg><br/>EMS Director Signature<br/><br/><svg height="3" width="4.5in"><line x1="0" y1="0" x2="4.5in" y2="0" style="stroke: rgb(0, 0, 0); stroke-width: 2;"></line></svg>Mayor<br/><br/>
                </div>
            </div>
        </body>
    </html>
</xsl:template>
</xsl:stylesheet>